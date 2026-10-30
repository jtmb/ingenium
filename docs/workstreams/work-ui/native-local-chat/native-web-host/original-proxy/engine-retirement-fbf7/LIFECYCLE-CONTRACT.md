# Original lifecycle and active quota contract for Root review

Source-only. Allocation7 and frozen094c/492f/fbf7 remain immutable. No runtime,
build, download, activation or quota-policy change is performed by this contract.
Root reserves allocation8 for an additive disposition design after review.

## Grounded transport ownership

Cargo.lock pins reqwest0.12.28, crates.io checksum
`eddd3ca559203180a307f12d114c268abf583f59b03cb906fd0b3ff8646c1147`.
`inspect-reqwest.py` verifies the existing F: archive checksum and compares all
four relevant cached source files to that archive in memory. It extracts no
files. `reqwest-ownership.json` records exact source hashes and line ranges.

The actual per-request Client is fresh. Its only surviving InnerClientHandle
owners after build are the private original transport Client and actual Response
KeepCoreThreadAlive. RequestBuilder's temporary Client clone dies at build;
Request owns no Client. No Client/Response escapes through our private API.
Dropping actual Response first, then final Client, reaches InnerClientHandle::drop:
tx.take closes the request channel and the real retained runtime JoinHandle is
synchronously joined. The runtime current-thread loop exits and drops its Tokio
runtime. The INNER join result is discarded by this locked library: termination
is established, normal inner-thread success is not. This cannot mint engine/tree
or HTTP-success authority, and must not turn unknown transport into admitted.

One original closer worker should consume those actual owners in that exact
order, with its real OUTER JoinHandle checked. Before spawn, a slot-owned opaque
capsule retains both owners; spawn error cannot drop the closure and lose them.
Before join, persist Pending/Failed; only the real checked join mints transport
termination. Timeout retains original handle/capsule. Panic/error latches Failed
across retries, even after handle consumption. Raw observation stays in the same
registry independently. No alternate HTTP stack, library patch or install is
needed for this concrete termination meaning. Inner-panic diagnosis remains
unobservable through this API; retain unknown admission/failure evidence.

Finite central real-TCP cases: normal materialized ACK and peer EOF; truncated
Content-Length and reset after a prefix; redirect never followed; no retry on
failure; withheld body/timeout; delayed closer; actual outer-worker panic then
retry; intentional extra Client owner counterexample. Assert one original send,
exact prefix/status retention, actual outer handle join, bounded worker census
and source identity. These are planned/supplied cases, not executed here.

## Four independent closure facts

1. Fresh authorization: current real ProjectStore/binding/session/model/engine;
   capture/reserve/send remain gated. Revocation only removes this authority.
2. Original publication: same private pre-send ProjectStore allocation appends
   exact complete ACK and existing minimal settlement together; sealed
   NativeWebPublished binds actual slot/op/input/body. Missing/forgotten scopes
   refuse content append; current-owner DTO or copied row cannot substitute.
3. Filesystem-read end: actual materialized User + publication + checked read
   close, OR actual SAME engine Arc/job-empty/worker-seal witness + checked read
   close. Engine admission flag, PID exit, metadata, Drop or unit stop do not
   establish this. Failed close stays protected; no other-path retry.
4. Transport end: actual original Response/final-Client closer + checked real
   join. Read end does not imply transport end. Raw partial bytes survive both
   until permitted private persistence/explicit privacy disposition.

The next retirement source delta binds actual Engine Arc and registry generation,
freezes admission/census under original locks and latches monitor/event/bootstrap
Pending/Joined/Failed. A missing consumed handle never becomes joined. Its tree
witness is Windows Direct job filesystem-read retirement, not global retirement.
Other backends need their actual retirement owners. No auto-exit/Drop witness.

## Actual quota behavior today

Allocation7 sums retained raw/effective/source/ACK bytes over ALL rows joined to
local_web_original_payloads, regardless of terminal state. Only explicit terminal
forget_native_web_payload removes ACK+sources+payload in one transaction, thereby
removing that charge. Minimal keys/tombstones survive. Unknown cannot forget.
The4096 key/operation lifetime checks also eventually block ordinary use. No
last-consumer reclamation exists. A rich long chat can therefore exhaust64MiB
without additional active work. This is a concrete availability gap.

## Proposed reviewed interface; no DDL/activation yet

Keep64MiB as a bounded ACTIVE original/replay/custody resource budget. Durable
terminal history and minimal no-replay keys remain exact user data on disk.
Exclude history from ACTIVE charge only after the real last consumer closes;
never prune history, silently forget content, or delete immutable identity.

The actual registry may mint a private move-only NativeWebLastConsumerClosed
only from same NativeWebPublished (or genuine original retirement), actual read
close, actual checked transport end, and the original resident-byte reservation
being released or transferred to a bounded shared response/replay owner. It
binds actual writer allocation, registry/slot generation, operation/input/body.
The existing ProjectStore consumes it in a separate retention-only disposition
transaction. A copied DTO, status, forged writer, close-start flag or DB row does
not mint release. It creates no chat/session/project/effect or replay grant.

Allocation8 may add immutable disposition metadata and replace ACTIVE accounting
guards additively; never rewrite allocation7. Release metadata must agree with
same existing immutable rows and real original evidence. Terminal BLOBs and
no-replay keys stay byte-exact. Unknown, active and failed-close resources remain
charged until genuine original retirement; a partial observation also needs
permitted private persistence before its unique in-memory bytes can disappear.
Existing tombstone/explicit forget behavior continues, with no resurrection.

Historical reads must reserve bounded response bytes BEFORE loading, use exact
indexed key lookup and bounded/paginated lists, and page immutable BLOB chunks or
share an actual charged immutable byte allocation. No full-history Vec load or
uncharged ACK copy. A response reservation survives every Arc/Bytes/body consumer
until its last actual owner ends; original-to-replay charge transfer cannot create
an uncharged interval. Persistent keys are indexed disk state, not an unbounded
resident key cache or4096 lifetime insertion brick. Keep bounded ACTIVE counts.

## Coherent20MiB representation gates

The existing8MiB source/16MiB wire/ACK limits are still real; do not independently
raise one. A20MiB URI source plus about26.7MiB base64 ACK can fit64MiB only with
bounded overhead and no extra full-size JSON/SQLite/request/reply copies. Inline
and WSL snapshot cases need shared raw/effective immutable bytes, bounded source
decode/hash, streaming source/ACK BLOB writes and ACK inspection without cloning
the full base64 JSON. Current serde Value/base64/params paths do not prove this.

Use actual-byte-validated lossless chunk/subrange/codec references where needed;
validate reconstruction length/hash and bounded decoded size, never assume a
compression ratio or semantic equivalence. Frozen7 physical column bounds require
an additive representation/schema design for larger logical payloads. Standard
image normalization, skills and prompt hooks still need actual authoritative
expansion bounds; default constants are not current proof. Preserve all supported
feature scope and private provenance. Root reviews exact peak and witnesses before
activation. No full20MiB/64MiB acceptance is claimed by this contract.

## Required counterexamples

- Multiple sequential terminal file-rich sends exceed64MiB on disk while ACTIVE
  returns to its bounded baseline after real closure; all historical bytes and
  stable-ID no-replay results remain exact.
- More than4096 sequential closed operations succeed without a resident all-key
  load or removed identity; changed input under an old stable key still conflicts.
- Lost ACK, partial body, active response Arc, extra Client clone, pending worker,
  failed join then retry, and failed checked close never release ACTIVE charge.
- Revocation permits only sealed original-row retention/disposition; new current
  owner and copied writer/slot objects cannot append, read, release or execute.
- Forget/tombstone during pending publication/disposition cannot resurrect data;
  logical forgetting is separate from ACTIVE release and filesystem erasure.
- Cold restart lists/reads page under bounded reservations; released historical
  payloads never all load or regain execution authority. Unknown stays no-replay.
- Twenty-MiB Windows URI, inline and WSL inputs include exact wire/source/ACK and
  real image/skill transforms; measured peak obeys64MiB with no hidden clones.

This is the compact interface/review boundary. Migration8 semantics, source
implementation and meaningful runtime qualification remain Root-reviewed gates.
