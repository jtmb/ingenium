# Concrete integration limits and required next work

This proposal has not been compiled or run. Do not activate it as a complete
resident-memory enforcement change. Source composition checks are narrower than
compiler, API/lifetime, SQLite behavior, HTTP ownership or full20MiB acceptance.

The current18-path proposal concretely changes:

- Actual NativeWebCompletions allocation owns one64MiB resident-payload pool.
  No slot census, terminal row, auth change or cleanup call decrements its bytes.
- NativeWebOriginal and EffectiveWebBody hold actual charged shared backing
  allocations. Windows identity shares the original. WSL transformed destination
  and replacement literals allocate from the same pool before copying.
- Native pre-read intake checks real lease/runtime and reserves BEFORE reading.
  Service facade/capture take that opaque intake rather than an allocated Vec.
  The supplied private Body consumer polls only after reservation and passes
  actual frames; no collect/to_bytes/full request JSON reconstruction.
- reqwest Reader holds the actual charged immutable original. Response observation
  allocates a fixed charged destination BEFORE HTTP, reads directly into it, and
  retains the exact prefix on read failure. Outcome/slot/client-closer copies
  retain actual allocation owners. Historical response pages use the same pool.
- The old full-ACK Vec reader is removed. Service submit returns its actual
  operation to a paged original-writer reader and Axum Body. Pages are read under
  the same actual row/BLOB/snapshot as full hash prepass, and checked close runs
  on every ordinary post-open result. Unknown/panic and consumed-close-error
  states remain non-successful. No new DB connection or ProjectStore writer.
- Real std JoinHandle originals are enrolled before spawn; reconciliation latches
  failure before taking a finished handle. Drop/cancel never detaches the sole
  unrecorded join. Abandoned successful jobs reconcile independently; actual
  failed joins/closes remain in the original service inventory.
- A final fresh original-writer/owner/session/forget check hands Payload to actual
  Bytes::from_owner while holding the same projects mutex used for forgetting.
  Bytes clones hold that allocation until their last real owner drops. Retained
  response bytes are not recalled or uncharged when forgetting subsequently wins.
  No SQLite borrow or store mutex spans network backpressure.

## Required remaining source gates before this patch can be activated

1. Existing web_original policy/classification and web_materialization scanner
   still parse full serde Values or owned strings. The existing WSL resolver,
   Windows captured source Vecs and provenance/path representations also remain
   uncharged. This proposal charges their final raw/effective body destinations,
   not all of their internal intermediates. These are real remaining escapes,
   not covered by payload bytes, a row sum, a larger pool or blanket reservation.
   Replace with bounded selective inspection/shared spans and charged source/
   decode destinations, preserving unknown raw JSON and exact bytes/hash framing.
   No whole-process RSS or complete64MiB acceptance is claimed.
2. Native's current16MiB wire/ACK and8MiB source checks/legacy schema constraints
   remain. Source capture, base64 transforms, authoritative engine image/skill
   expansion and complete ACK observation require reviewed lossless chunked
   representation before full ordinary20MiB can be accepted. Do not silently raise
   limits, remove normal supported features or call a rejection acceptance.
3. Actual rusqlite0.40.2 blob feature must be additively enabled by Root. Proposed
   Cargo change is ONLY features [bundled,backup,blob]; version/pin/source/lock
   unchanged. No such manifest or dependency change occurs in this worker tree.
4. Allocation8 requires Root's additive schema protocol and validation from
   SCHEMA8-SHAPE.md, including replacement of lifetime4096 and historical SUM
   guards while preserving every original byte/key/forget/unknown fence. No DDL
   is written here. Legacy page reads work against actual old BLOB columns.
5. Actual outer authenticated private proxy producer/mount is missing in current
   Native source. apps/service routes/local_workspaces/web_original::{acquire,
   capture,submit_prompt} are real facade consumers; their outer caller is absent.
   Desktop NativeAuthLease and OriginalWebAuthority have no actual implementation.
   receive_prompt is a concrete scoped Body consumer for that handler, but is not
   mounted on an ordinary bearer/public router. Root must bind actual native child,
   private origin/profile/current-view lifecycle and auth, not pass a positive DTO.
6. Framework/SQLite/reqwest metadata and buffer allocations, pool Arc bookkeeping,
   thread stacks, HTTP header values and page registry descriptors need bounded
   integration/measurement. Bytes::from_owner uses a wrapper allocation. A bounded
   payload pool is explicitly not a process RSS bound. The original store's owner/
   custody/session queries also need review for metadata expansion and indexes.
7. Paged legacy reads rescan the entire BLOB per page. Bound CPU/deadline behavior
   and distinguish timeout from success. Schema8 sealed immutable chunks are the
   intended efficient path; positive hash/manifest authority must originate from
   actual bytes under the original writer, never declared metadata alone.

Required runtime counterexamples include lost ACK, partial observer failure,
read/close fault, real worker panic then retry, response clone surviving slot
removal, forgotten page before/after handoff, changed row/snapshot/hash, cold
restart, more than4096 historical operations, exact Windows/WSL/inline20MiB and
full peak measurement. Seven supplied low-level Rust fixtures remain UNRUN;
finite source checks do not substitute for these original acceptance gates.

All generated paths stay in this directory under the previously declared root.
No disposable bulk or disk fixture database exists. Keep source/recipes/hashes
for Root review; remove none (0 bytes). No Windows/Linux recovery is claimed.
